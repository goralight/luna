import { Field } from 'payload'

export const dayEntryFields: Field[] = [
  {
    name: 'user',
    type: 'relationship',
    relationTo: 'users',
    required: true,
    index: true,
    defaultValue: ({ user }) => user?.id || undefined,
    maxDepth: 0,
  },
  {
    name: 'date',
    type: 'date',
    required: true,
    index: true,
    admin: {
      readOnly: true,
      date: {
        displayFormat: 'dd/MM/yyyy',
      },
    },
  },
  {
    name: 'moodRating',
    type: 'select',
    options: Array.from({ length: 10 }, (_, i) => {
      const value = String(i + 1)
      return { label: value, value }
    }),
    required: true,
  },
  {
    name: 'weight',
    type: 'number',
    required: false,
  },
  { name: 'minutesPainted', type: 'number', min: 0, required: false },
  { name: 'dives', type: 'number', min: 0, max: 5, required: false },
  { name: 'note', type: 'textarea', required: false },
]

