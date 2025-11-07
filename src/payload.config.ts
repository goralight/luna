import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { s3Storage } from '@payloadcms/storage-s3'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Checklists } from './collections/Checklists'
import { ChecklistGroups } from './collections/ChecklistGroups'
import { searchPlugin } from '@payloadcms/plugin-search'
import { FaIcons } from './collections/faIcons'
import { DayEntries } from './collections/DayEntry/index'
import { Places } from './collections/Places'
import { Trips } from './collections/Trips/index'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Checklists, ChecklistGroups, FaIcons, Media, Places, Trips, DayEntries],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
  sharp,
  cors: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://luna.goralight.com',
    'https://nox.goralight.com',
    'https://goralight.com',
  ],
  csrf: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://luna.goralight.com',
    'https://nox.goralight.com',
    'https://goralight.com',
  ],
  plugins: [
    payloadCloudPlugin(),
    searchPlugin({
      collections: ['checklists', 'checklist-groups', 'users'],
      defaultPriorities: {
        checklists: 10,
        'checklist-groups': 20,
        users: 30,
      },
    }),
    s3Storage({
      collections: {
        media: true,
      },
      bucket: process.env.S3_BUCKET || '',
      config: {
        endpoint: process.env.S3_ENDPOINT || '',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
        region: process.env.S3_REGION || '',
      },
    }),
  ],
})
