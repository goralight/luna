'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'

const COLLECTION_SLUG = 'day-entries'
const API_BASE = '/api'
const ADMIN_BASE = '/admin'

export default function CalendarListView() {
  const router = useRouter()
  const { user } = useAuth()
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [hasEntrySet, setHasEntrySet] = useState<Set<string>>(new Set())

  const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

  const fetchMonthEntries = async (monthDate: Date) => {
    if (!user) return
    const start = startOfMonth(monthDate)
    const end = endOfMonth(monthDate)

    const params = new URLSearchParams()
    params.set('limit', '500')
    params.set('where[and][0][user][equals]', String(user.id))
    params.set('where[and][1][date][greater_than_equal]', ymd(start))
    params.set('where[and][2][date][less_than_equal]', ymd(end))

    const res = await fetch(`${API_BASE}/${COLLECTION_SLUG}?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return

    const data: { docs: Array<{ id: string; date: string }> } = await res.json()
    const next = new Set<string>()
    for (const doc of data.docs || []) {
      const str = (doc.date || '').slice(0, 10)
      if (str) next.add(str)
    }
    setHasEntrySet(next)
  }

  useEffect(() => {
    fetchMonthEntries(visibleMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, visibleMonth])

  const handleSelect = async (selectedDate?: Date) => {
    if (!selectedDate || !user) return

    const dateStr = format(selectedDate, 'yyyy-MM-dd')
    const nextDayStr = format(addDays(selectedDate, 1), 'yyyy-MM-dd')

    // Query for existing Day Entry for this user + date
    const query = new URLSearchParams()
    query.set('limit', '1')
    query.set('where[and][0][user][equals]', String(user.id))
    query.set('where[and][1][date][greater_than_equal]', dateStr)
    query.set('where[and][2][date][less_than]', nextDayStr)

    const res = await fetch(`${API_BASE}/${COLLECTION_SLUG}?${query.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) return

    const data: { docs: Array<{ id: string }> } = await res.json()
    const existing = data?.docs?.[0]

    if (existing?.id) {
      router.push(`${ADMIN_BASE}/collections/${COLLECTION_SLUG}/${existing.id}`)
      return
    }

    // No existing entry: create one with selected date and current user, then navigate to it
    const createRes = await fetch(`${API_BASE}/${COLLECTION_SLUG}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: String(user.id),
        date: dateStr,
        // Provide safe defaults for required fields in case the schema enforces them
        moodRating: 5,
      }),
    })

    if (createRes.ok) {
      const created: { id: string } = await createRes.json()
      setHasEntrySet((prev) => {
        const next = new Set(prev)
        next.add(dateStr)
        return next
      })
      router.push(`${ADMIN_BASE}/collections/${COLLECTION_SLUG}/${created.id}`)
    }
  }

  if (!user) {
    return <div>Loading...</div>
  }

  const modifiers = useMemo(
    () => ({ hasEntry: (date: Date) => hasEntrySet.has(ymd(date)) }),
    [hasEntrySet],
  )

  return (
    <div className="calendarListContainer">
      <h2 className="calendarHeading">Pick a date to edit</h2>
      <DayPicker
        mode="single"
        weekStartsOn={1}
        onSelect={handleSelect}
        onMonthChange={setVisibleMonth}
        defaultMonth={visibleMonth}
        modifiers={modifiers}
        modifiersClassNames={{ hasEntry: 'hasEntry' }}
      />
      <p className="calendarHelpText">
        Selecting a day will open the entry for that date. If none exists, you'll be taken to create
        one with the date prefilled.
      </p>
    </div>
  )
}
