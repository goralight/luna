import type { TextField } from 'payload'

type Options = {
  trackingField?: string
}

export const slug = (
  { trackingField = 'title' }: Options = {},
  overrides?: Omit<Partial<TextField>, 'hasMany' | 'maxRows' | 'minRows' | 'validate'>,
): TextField => ({
  name: 'slug',
  type: 'text',
  hasMany: false as const,
  unique: true,
  required: true,
  admin: {
    position: 'sidebar',
    components: {
      Field: {
        path: 'ui/SlugInput',
        exportName: 'SlugInput',
        clientProps: { trackingField },
      },
    },
  },
  ...overrides,
})
