import { ArrayRowLabel } from '@/app/(payload)/ArrayRowLabel'
import { CollectionConfig } from 'payload'

export const Checklists: CollectionConfig = {
  slug: 'checklists',
  admin: {
    useAsTitle: 'title',
    group: 'Checklists',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true
    },
    {
      name: 'items',
      type: 'array',
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
        }
      ]
    }
  ]
}