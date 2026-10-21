import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

export type HostResolver = (host: string) => Promise<readonly string[]>

export interface AddressPolicy {
  readonly allowedAddresses: BlockList
  readonly allowedHostNames: ReadonlySet<string>
  readonly resolve: HostResolver
}

const systemResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map(({ address }) => address)

const ipFamily = (address: string) => (isIP(address) === 6 ? 'ipv6' : 'ipv4')

// A fully qualified name ends with a dot and names the same host as the name without it.
const hostNameKey = (host: string) => host.toLowerCase().replace(/\.$/, '')

// An IPv4 rule of a BlockList also matches the IPv4-mapped IPv6 form of the address.
const blockedRanges = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  blockedRanges.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['fc00::', 7],
  // RFC 8215 lets the operator choose where in this local-use NAT64 prefix the IPv4 address sits.
  ['64:ff9b:1::', 48],
] as const) {
  blockedRanges.addSubnet(network, prefix, 'ipv6')
}

const hexGroups = (part: string) =>
  part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16))

// A URL writes the trailing dotted IPv4 part of an IPv6 address in hexadecimal.
const ipv6Groups = (address: string) => {
  const [head = '', tail] = new URL(`http://[${address.replace(/%.*$/, '')}]`).hostname
    .slice(1, -1)
    .split('::')

  const headGroups = hexGroups(head)
  const tailGroups = tail === undefined ? [] : hexGroups(tail)

  return [
    ...headGroups,
    ...Array.from({ length: 8 - headGroups.length - tailGroups.length }, () => 0),
    ...tailGroups,
  ]
}

const ipv4Of = (high: number, low: number) =>
  [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')

// IPv4-compatible (::/96), NAT64 (64:ff9b::/96), SIIT (::ffff:0:0/96) and 6to4 (2002::/16) reach IPv4.
const embeddedIpv4 = (address: string) => {
  const groups = ipv6Groups(address)
  const group = (index: number) => groups[index] ?? 0
  const zeroFrom32To64 = group(2) === 0 && group(3) === 0
  const compatible = group(0) === 0 && group(1) === 0 && group(4) === 0 && group(5) === 0
  const nat64 = group(0) === 0x64 && group(1) === 0xff9b && group(4) === 0 && group(5) === 0
  const siit = group(0) === 0 && group(1) === 0 && group(4) === 0xffff && group(5) === 0

  if (zeroFrom32To64 && (compatible || nat64 || siit)) {
    return ipv4Of(group(6), group(7))
  }

  return group(0) === 0x2002 ? ipv4Of(group(1), group(2)) : undefined
}

const addAllowedEntry = (allowed: BlockList, hostNames: Set<string>, entry: string) => {
  const [network, prefix] = entry.split('/')

  if (network !== undefined && prefix !== undefined && isIP(network) !== 0) {
    allowed.addSubnet(network, Number(prefix), ipFamily(network))
  } else if (isIP(entry) !== 0) {
    allowed.addAddress(entry, ipFamily(entry))
  } else {
    hostNames.add(hostNameKey(entry))
  }
}

export const addressPolicy = (
  allowedHosts: readonly string[],
  resolve: HostResolver = systemResolver,
): AddressPolicy => {
  const allowedAddresses = new BlockList()
  const allowedHostNames = new Set<string>()

  for (const entry of allowedHosts) {
    addAllowedEntry(allowedAddresses, allowedHostNames, entry.trim())
  }

  return { allowedAddresses, allowedHostNames, resolve }
}

const isAllowed = (policy: AddressPolicy, address: string) =>
  policy.allowedAddresses.check(address, ipFamily(address))

const isBlockedAddress = (policy: AddressPolicy, address: string) =>
  blockedRanges.check(address, ipFamily(address)) && !isAllowed(policy, address)

const isBlocked = (policy: AddressPolicy, address: string) => {
  const ipv4 = isIP(address) === 6 ? embeddedIpv4(address) : undefined

  return (
    isBlockedAddress(policy, address) ||
    (ipv4 !== undefined && !isAllowed(policy, address) && isBlockedAddress(policy, ipv4))
  )
}

export const blockedAddressOf = (
  policy: AddressPolicy,
  host: string,
  addresses: readonly string[],
) =>
  policy.allowedHostNames.has(hostNameKey(host))
    ? undefined
    : addresses.find((address) => isBlocked(policy, address))
