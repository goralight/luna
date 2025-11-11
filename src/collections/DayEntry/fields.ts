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
  // New trackers blocks with per-tracker notes
  {
    name: 'trackers',
    type: 'blocks',
    required: false,
    defaultValue: () => [
      { blockType: 'mood', value: undefined, note: '' },
      { blockType: 'weight', value: undefined, note: '' },
    ],
    validate: (blocks) => {
      if (!Array.isArray(blocks)) return true
      const seen = new Set<string>()
      for (const block of blocks) {
        const slug = (block as any)?.blockType as string | undefined
        if (!slug) continue
        if (seen.has(slug)) {
          return `You can only add one ${slug} tracker`
        }
        seen.add(slug)
      }
      return true
    },
    blocks: [
      {
        slug: 'mood',
        labels: { singular: 'Mood', plural: 'Mood' },
        fields: [
          {
            name: 'value',
            type: 'select',
            options: Array.from({ length: 10 }, (_, i) => {
              const value = String(i + 1)
              return { label: value, value }
            }),
            required: false,
          },
          { name: 'note', type: 'textarea', required: false },
        ],
      },
      {
        slug: 'weight',
        labels: { singular: 'Weight', plural: 'Weight' },
        fields: [
          { name: 'value', type: 'number', required: false },
          { name: 'note', type: 'textarea', required: false },
        ],
      },
      {
        slug: 'diving',
        labels: { singular: 'Diving', plural: 'Diving' },
        fields: [
          { name: 'value', type: 'number', min: 0, max: 5, required: false },
          { name: 'note', type: 'textarea', required: false },
        ],
      },
      {
        slug: 'painting',
        labels: { singular: 'Painting', plural: 'Painting' },
        fields: [
          { name: 'value', type: 'number', min: 0, required: false },
          { name: 'note', type: 'textarea', required: false },
        ],
      },
    ],
  },
  {
    name: 'moodRating',
    type: 'select',
    options: Array.from({ length: 10 }, (_, i) => {
      const value = String(i + 1)
      return { label: value, value }
    }),
    required: false,
    admin: { hidden: true },
  },
  {
    name: 'weight',
    type: 'number',
    required: false,
    admin: { hidden: true },
  },
  { name: 'minutesPainted', type: 'number', min: 0, required: false, admin: { hidden: true } },
  { name: 'dives', type: 'number', min: 0, max: 5, required: false, admin: { hidden: true } },
  { name: 'note', type: 'textarea', required: false, admin: { hidden: true } },
]
