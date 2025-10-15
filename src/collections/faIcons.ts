import type { CollectionConfig } from 'payload'

export const FaIcons: CollectionConfig = {
  slug: 'fa-icons',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'label',
    group: 'Design System',
    defaultColumns: ['label', 'prefix', 'name', 'className'],
  },
  fields: [
    {
      name: 'label',
      type: 'text',
      required: true,
    },
    {
      name: 'prefix',
      type: 'select',
      required: true,
      options: [
        { label: 'Solid', value: 'fas' },
        { label: 'Regular', value: 'far' },
        { label: 'Brands', value: 'fab' },
      ],
    },
    {
      name: 'name',
      label: 'Icon name (Font Awesome)',
      type: 'text',
      required: true,
      admin: {
        description:
          'e.g. plane, hotel, car, user, calendar. | https://fontawesome.com/search?f=classic&s=solid&ic=free&o=r',
      },
    },
    {
      name: 'className',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'auto-generated: e.g. fa-solid fa-plane',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data
        // map FA prefix -> CSS style segment for className convenience
        const styleMap: Record<string, string> = {
          fas: 'fa-solid',
          far: 'fa-regular',
          fab: 'fa-brands',
        }

        const style = data.prefix ? styleMap[data.prefix] : undefined
        if (style && data.name) {
          data.className = `${style} fa-${data.name}`
        }
        return data
      },
    ],
  },
}
