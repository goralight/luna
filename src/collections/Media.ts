import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    crop: true,
    focalPoint: true,
    imageSizes: [
      {
        name: 'thumb', // 16:9
        width: 320,
        height: 180,
        position: 'center',
        generateImageName: ({ originalName }) => `${originalName}__thumb`,
      },
      {
        name: 'square', // 1:1
        width: 800,
        height: 800,
        position: 'center',
        generateImageName: ({ originalName }) => `${originalName}__square`,
      },
      {
        name: 'hero', // 16:9
        width: 1920,
        height: 1080,
        position: 'center',
        generateImageName: ({ originalName }) => `${originalName}__hero`,
      },
    ],
    adminThumbnail: 'thumb',
    mimeTypes: ['image/*', 'video/*'],
  },
}
