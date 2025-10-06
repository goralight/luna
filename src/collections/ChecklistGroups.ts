// src/collections/ChecklistGroups.ts
import { CollectionConfig } from 'payload'

export const ChecklistGroups: CollectionConfig = {
  slug: 'checklist-groups',
  admin: {
    useAsTitle: 'title',
    group: 'Checklists'
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true
    },
    {
      name: 'checklists',
      type: 'relationship',
      relationTo: 'checklists', // references the 'checklists' collection
      hasMany: true // allows multiple checklists in the array
    }
  ]
}
