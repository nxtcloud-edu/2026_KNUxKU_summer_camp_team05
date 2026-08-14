const won = new Intl.NumberFormat('ko-KR')

export const formatKrw = (amount: number) => `₩${won.format(amount)}`

export const formatCompactKrw = (amount: number) => `₩${Math.round(amount / 1000)}K`
