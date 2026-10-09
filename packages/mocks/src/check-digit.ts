export function withCheckDigit(digits: string) {
  const sum = [...digits]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)

  return `${digits}${(10 - (sum % 10)) % 10}`
}
