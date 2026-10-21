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

// An IPv4 rule of a BlockList also matches the IPv4-mapped IPv6 form of the address.
const blockedRanges = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
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
] as const) {
  blockedRanges.addSubnet(network, prefix, 'ipv6')
}

const allowedEntry = (allowed: BlockList, hostNames: Set<string>, entry: string) => {
  const [network, prefix] = entry.split('/')

  if (network !== undefined && prefix !== undefined && isIP(network) !== 0) {
    allowed.addSubnet(network, Number(prefix), ipFamily(network))
  } else if (isIP(entry) !== 0) {
    allowed.addAddress(entry, ipFamily(entry))
  } else {
    hostNames.add(entry.toLowerCase())
  }
}

export const addressPolicy = (
  allowedPrivateHosts: readonly string[],
  resolve: HostResolver = systemResolver,
): AddressPolicy => {
  const allowedAddresses = new BlockList()
  const allowedHostNames = new Set<string>()

  for (const entry of allowedPrivateHosts) {
    allowedEntry(allowedAddresses, allowedHostNames, entry.trim())
  }

  return { allowedAddresses, allowedHostNames, resolve }
}

const isBlocked = (policy: AddressPolicy, address: string) =>
  blockedRanges.check(address, ipFamily(address)) &&
  !policy.allowedAddresses.check(address, ipFamily(address))

export const blockedAddressOf = (
  policy: AddressPolicy,
  host: string,
  addresses: readonly string[],
) =>
  policy.allowedHostNames.has(host.toLowerCase())
    ? undefined
    : addresses.find((address) => isBlocked(policy, address))
