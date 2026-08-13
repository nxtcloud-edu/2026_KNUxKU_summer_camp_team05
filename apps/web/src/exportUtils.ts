import { itineraryDays } from './data'

export async function copyText(value:string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export async function shareTrip(url:string) {
  if (navigator.share) {
    await navigator.share({ title:'MOA 오사카 3박 4일', text:'MOA에서 정리한 우리 여행을 확인해보세요.', url })
    return 'shared' as const
  }
  await copyText(url)
  return 'copied' as const
}

const pad = (value:number) => String(value).padStart(2,'0')
const formatIcsDate = (date:Date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`
const escapeIcs = (value:string) => value.replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n')

export function downloadTripCalendar() {
  const tripStart = new Date(2026, 9, 15)
  const events = itineraryDays.flatMap((day, dayIndex) => day.items.map(([time,title,meta], itemIndex) => {
    const [hours,minutes] = time.split(':').map(Number)
    const start = new Date(tripStart.getFullYear(), tripStart.getMonth(), tripStart.getDate() + dayIndex, hours, minutes)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    return ['BEGIN:VEVENT',`UID:moa-${dayIndex}-${itemIndex}@moa.travel`,`DTSTAMP:${formatIcsDate(new Date())}`,`DTSTART:${formatIcsDate(start)}`,`DTEND:${formatIcsDate(end)}`,`SUMMARY:${escapeIcs(title)}`,`LOCATION:${escapeIcs(title)}`,`DESCRIPTION:${escapeIcs(meta)}`,'END:VEVENT'].join('\r\n')
  }))
  const content = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MOA//Group Travel Plan//KO','CALSCALE:GREGORIAN','METHOD:PUBLISH',...events,'END:VCALENDAR'].join('\r\n')
  const blob = new Blob([content], { type:'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'moa-osaka-trip.ics'
  anchor.click()
  URL.revokeObjectURL(url)
}
