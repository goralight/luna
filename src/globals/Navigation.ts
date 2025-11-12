import type { GlobalConfig } from 'payload'

export const Navigation: GlobalConfig = {
  slug: 'navigation',
  access: {
    read: () => true,
  },
  endpoints: [
    {
      path: '/public',
      method: 'get',
      handler: async (req) => {
        const nav = await req.payload.findGlobal({
          slug: 'navigation',
          depth: 1,
        })

        const items = Array.isArray((nav as any)?.items) ? (nav as any).items : []

        const response = items.map((item: any) => ({
          id: item?.id,
          label: item?.label,
          slug: item?.slug,
          icon: item?.icon ? (item.icon as any).className : undefined,
          redirectToFirst: Boolean(item?.redirectToFirst),
          subNav: Array.isArray(item?.subNav)
            ? item.subNav.map((sub: any) => ({
                id: sub?.id,
                label: sub?.label,
                slug: sub?.slug,
                icon: sub?.icon ? (sub.icon as any).className : undefined,
              }))
            : [],
        }))
        return Response.json(response)
      },
    },
  ],
  admin: {
    group: 'Site',
    hidden: false,
  },
  fields: [
    {
      name: 'items',
      label: 'Navigation Items',
      type: 'array',
      required: true,
      fields: [
        {
          name: 'label',
          type: 'text',
          required: true,
        },
        {
          name: 'slug',
          type: 'text',
          required: true,
        },
        {
          name: 'icon',
          type: 'relationship',
          relationTo: 'fa-icons',
          required: false,
        },
        {
          name: 'redirectToFirst',
          type: 'checkbox',
          defaultValue: false,
          required: false,
        },
        {
          name: 'subNav',
          label: 'Sub Navigation',
          type: 'array',
          required: false,
          fields: [
            {
              name: 'label',
              type: 'text',
              required: true,
            },
            {
              name: 'slug',
              type: 'text',
              required: true,
            },
            {
              name: 'icon',
              type: 'relationship',
              relationTo: 'fa-icons',
              required: false,
            },
          ],
        },
      ],
    },
  ],
}
