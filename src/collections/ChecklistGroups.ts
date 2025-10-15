import { CollectionConfig } from 'payload'
import slugify from 'slugify'

export const ChecklistGroups: CollectionConfig = {
  slug: 'checklist-groups',
  access: {
    read: () => true,
  },
  folders: true,
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
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
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
        description: 'Pick a Font Awesome icon'
      }
    },
    {
      name: 'checklists',
      type: 'relationship',
      relationTo: 'checklists', // references the 'checklists' collection
      hasMany: true, // allows multiple checklists in the array
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data && typeof data.title === 'string' && !data.slug) {
          data.slug = slugify(data.title, {
            lower: true,
            strict: true,
            trim: true,
          })
        }
        return data
      },
    ],
  },
}
