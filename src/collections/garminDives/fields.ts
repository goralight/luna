import { Field } from 'payload'

export const garminDiveFields: Field[] = [
  {
    name: 'garminActivityId',
    type: 'text',
    required: true,
    unique: true,
  },
  {
    name: 'diveType',
    type: 'select',
    required: true,
    defaultValue: 'recreational',
    options: [
      { label: 'Recreational', value: 'recreational' },
      { label: 'Course', value: 'course' },
      { label: 'Instructing', value: 'instructing' },
    ],
    admin: {
      description: 'What type of dive this was. Not ported from Garmin.',
    },
  },
  {
    name: 'diveCourse',
    type: 'select',
    label: 'Diving course',
    options: [
      { label: 'OW', value: 'ow' },
      { label: 'AOW', value: 'aow' },
      { label: 'Drysuit', value: 'drysuit' },
      { label: 'Deep', value: 'deep' },
      { label: 'Wreck', value: 'wreck' },
      { label: 'Night', value: 'night' },
      { label: 'Rescue', value: 'rescue' },
    ],
    admin: {
      condition: (_, siblingData) =>
        siblingData?.diveType === 'course' || siblingData?.diveType === 'instructing',
      description: 'Select the course when logging training or instructing dives. Not ported from Garmin.',
    },
  },
  {
    name: 'notes',
    type: 'textarea',
    admin: {
      description: 'Additional notes about the dive. Not ported from Garmin.',
      width: 'full',
    },
  },
  {
    name: 'cylinder',
    type: 'group',
    label: 'Cylinder',
    defaultValue: {
      selection: '12l',
      shape: 'long',
    },
    fields: [
      {
        name: 'type',
        type: 'select',
        label: 'Cylinder',
        defaultValue: '12l',
        options: [
          { label: '12L', value: '12l' },
          { label: '15L', value: '15l' },
          { label: '10L', value: '10l' },
          { label: 'Twin-set 12L', value: 'twin-set-12l' },
          { label: 'Twin-set 10L', value: 'twin-set-10l' },
          { label: 'Twin-set 8L', value: 'twin-set-8l' },
        ],
        admin: {
          description: 'Select the cylinder used for the dive. Not ported from Garmin.',
        },
      },
      {
        name: 'shape',
        type: 'select',
        label: 'Cylinder Shape',
        defaultValue: 'long',
        options: [
          { label: 'Long', value: 'long' },
          { label: 'Dumpy', value: 'dumpy' },
        ],
        admin: {
          condition: (_, siblingData: { selection?: string } | null | undefined) => {
            const selectedCylinder = siblingData?.selection
            return selectedCylinder === '12l' || selectedCylinder === '15l' || selectedCylinder === '10l'
          },
          description: 'Select the shape of the cylinder used for the dive. Not ported from Garmin.',
        },
      },
    ],
  },
  {
    name: 'redundantCylinder',
    type: 'select',
    label: 'Redundant Cylinder',
    defaultValue: 'none',
    options: [
      { label: 'None', value: 'none' },
      { label: '3L Pony', value: '3l-pony' },
      { label: '6L Pony', value: '6l-pony' },
    ],
    admin: {
      description: 'Select the redundant cylinder used for the dive. Not ported from Garmin.',
    },
  },
  {
    name: 'cylinderPressure',
    label: 'Cylinder Pressure (bar)',
    admin: {
      description: 'The pressure of the cylinder at the start and end of the dive. Not ported from Garmin.',
    },
    type: 'group',
    fields: [
      {
        name: 'start',
        type: 'number',
      },
      {
        name: 'end',
        type: 'number',
      },
    ],
  },
  {
    name: 'weight',
    label: 'Weight',
    type: 'group',
    admin: {
      description: 'Lead distribution used for the dive (kg). Not ported from Garmin.',
    },
    fields: [
      {
        name: 'trim',
        type: 'group',
        fields: [
          {
            name: 'leftKg',
            type: 'number',
            min: 0,
            defaultValue: 1,
          },
          {
            name: 'rightKg',
            type: 'number',
            min: 0,
            defaultValue: 1,
          },
        ],
      },
      {
        name: 'pouch',
        type: 'group',
        fields: [
          {
            name: 'leftKg',
            type: 'number',
            min: 0,
            defaultValue: 3,
          },
          {
            name: 'rightKg',
            type: 'number',
            min: 0,
            defaultValue: 3,
          },
        ],
      },
      {
        name: 'beltKg',
        label: 'Belt Weight Kg',
        type: 'number',
        min: 0,
        defaultValue: 0,
      },
    ],
  },
  {
    name: 'exposureProtection',
    type: 'select',
    label: 'Exposure Protection',
    defaultValue: 'Santi E.Lite Drysuit',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Santi E.Lite Drysuit', value: 'Santi E.Lite Drysuit' },
      { label: '5mm Beuchat Wetsuit', value: '5mm Beuchat Wetsuit' },
    ],
    admin: {
      description: 'Select the exposure protection used for the dive. Not ported from Garmin.',
    },
  },
  {
    name: 'startTimeLocal',
    type: 'text',
    required: true,
  },
  {
    name: 'startTimeGMT',
    type: 'text',
    required: true,
  },
  {
    name: 'title',
    type: 'text',
  },
  {
    name: 'durationSeconds',
    type: 'number',
  },
  {
    name: 'maxDepthMeters',
    type: 'number',
  },
  {
    name: 'avgDepthMeters',
    type: 'number',
  },
  {
    name: 'location',
    type: 'text',
  },
  {
    name: 'coordinates',
    label: 'Coordinates',
    type: 'group',
    fields: [
      {
        name: 'latitude',
        label: 'Latitude',
        type: 'number',
      },
      {
        name: 'longitude',
        label: 'Longitude',
        type: 'number',
      },
    ],
  },
  {
    name: 'temperature',
    label: 'Temperature',
    type: 'group',
    fields: [
      {
        name: 'min',
        label: 'Min Temperature',
        type: 'number',
        admin: {
          description: 'Minimum recorded temperature (°C)',
        },
      },
      {
        name: 'max',
        label: 'Max Temperature',
        type: 'number',
        admin: {
          description: 'Maximum recorded temperature (°C)',
        },
      },
    ],
  },
  {
    name: 'surfaceIntervalSeconds',
    type: 'number',
  },
  {
    name: 'gases',
    type: 'array',
    label: 'Dive Gases',
    fields: [
      {
        name: 'oxygenPercent',
        type: 'number',
        required: true,
        min: 0,
        max: 100,
        admin: {
          description: 'Oxygen percentage (O₂)',
        },
      },
      {
        name: 'heliumPercent',
        type: 'number',
        required: true,
        min: 0,
        max: 100,
        admin: {
          description: 'Helium percentage (He)',
        },
      },
    ],
  },
]

