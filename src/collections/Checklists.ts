import { CollectionConfig } from 'payload'

export const Checklists: CollectionConfig = {
  slug: 'checklists',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'title',
    group: 'Checklists',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'icon',
      type: 'relationship',
      relationTo: 'fa-icons',
      required: false,
      maxDepth: 1,
      admin: {
        description: 'Pick a Font Awesome icon'
      }
    },
    {
      name: 'items',
      type: 'array',
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
        },
      ],
    },
  ],
}
