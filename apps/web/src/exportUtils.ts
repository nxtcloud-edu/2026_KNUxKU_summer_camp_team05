import type { TripDay } from './travel/models'

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
const escapeIcs = (value:string) => value.replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n')

export function downloadTripCalendar(days: TripDay[]) {
  const events = days.flatMap((day) => day.events.map((event, itemIndex) => {
    const localStart = `${day.dateIso.replaceAll('-', '')}T${event.time.replace(':', '')}00`
    const [hours, minutes] = event.time.split(':').map(Number)
    const endMinutes = (hours * 60 + minutes + 60) % (24 * 60)
    const localEnd = `${day.dateIso.replaceAll('-', '')}T${pad(Math.floor(endMinutes / 60))}${pad(endMinutes % 60)}00`
    return ['BEGIN:VEVENT',`UID:moa-${day.id}-${itemIndex}@moa.travel`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,`DTSTART;TZID=Asia/Tokyo:${localStart}`,`DTEND;TZID=Asia/Tokyo:${localEnd}`,`SUMMARY:${escapeIcs(event.title)}`,`LOCATION:${escapeIcs(event.title)}`,`DESCRIPTION:${escapeIcs(event.detail ?? '')}`,'END:VEVENT'].join('\r\n')
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
