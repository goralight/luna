import { CollectionConfig } from 'payload'

export const Checklists: CollectionConfig = {
  slug: 'checklists',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'title',
    group: 'Checklists',
    defaultColumns: ['title', 'description'],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'text',
    },
    {
      name: 'icon',
      type: 'relationship',
      relationTo: 'fa-icons',
      required: false,
      admin: {
        description: 'Pick a Font Awesome icon',
      },
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
