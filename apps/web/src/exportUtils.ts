import type { TripDay } from './travel/models'
import type { DestinationPack } from './product/types'

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

type ShareTripMetadata = Pick<DestinationPack, 'name'> & { duration?: string }

export async function shareTrip(url:string, trip: ShareTripMetadata) {
  if (navigator.share) {
    const duration = trip.duration ? ` ${trip.duration}` : ''
    await navigator.share({ title:`MOA ${trip.name}${duration} 여행`, text:'MOA에서 정리한 우리 여행을 확인해보세요.', url })
    return 'shared' as const
  }
  await copyText(url)
  return 'copied' as const
}

const pad = (value:number) => String(value).padStart(2,'0')
const escapeIcs = (value:string) => value.replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n')

type CalendarDestination = Pick<DestinationPack, 'id' | 'name' | 'timeZone'>

export type TripCalendarOptions = {
  days: TripDay[]
  destination: CalendarDestination
  defaultEventDurationMinutes?: number
}

const calendarSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function localDateTime(dateIso: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) return undefined
  const [, year, month, day] = dateMatch
  const [, hours, minutes] = timeMatch
  const values = [year, month, day, hours, minutes].map(Number)
  if (values.some((value) => !Number.isFinite(value))) return undefined
  const date = new Date(Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4]))
  if (
    date.getUTCFullYear() !== values[0]
    || date.getUTCMonth() !== values[1] - 1
    || date.getUTCDate() !== values[2]
    || date.getUTCHours() !== values[3]
    || date.getUTCMinutes() !== values[4]
  ) return undefined
  return date
}

const formatLocalDateTime = (value: Date) => `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}00`

export function buildTripCalendar({ days, destination, defaultEventDurationMinutes = 60 }: TripCalendarOptions) {
  const slug = calendarSlug(destination.id)
  const events = days.flatMap((day) => day.events.flatMap((event, itemIndex) => {
    const start = localDateTime(day.dateIso, event.time)
    if (!start) return []
    const requestedDuration = event.durationMinutes ?? defaultEventDurationMinutes
    const durationMinutes = Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : defaultEventDurationMinutes
    const end = new Date(start.getTime() + durationMinutes * 60_000)
    return [['BEGIN:VEVENT',`UID:moa-${slug}-${day.id}-${itemIndex}@moa.travel`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,`DTSTART;TZID=${destination.timeZone}:${formatLocalDateTime(start)}`,`DTEND;TZID=${destination.timeZone}:${formatLocalDateTime(end)}`,`SUMMARY:${escapeIcs(event.title)}`,`DESCRIPTION:${escapeIcs(event.detail ?? '')}`,'END:VEVENT'].join('\r\n')]
  }))
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MOA//Group Travel Plan//KO','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${escapeIcs(`MOA ${destination.name} 여행`)}`,`X-WR-TIMEZONE:${destination.timeZone}`,...events,'END:VCALENDAR'].join('\r\n')
}

export function downloadTripCalendar(options: TripCalendarOptions) {
  const content = buildTripCalendar(options)
  const blob = new Blob([content], { type:'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `moa-${calendarSlug(options.destination.id)}-trip.ics`
  anchor.click()
  URL.revokeObjectURL(url)
}
