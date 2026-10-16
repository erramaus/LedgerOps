import { DEMO_CLIENT_ID } from './demoBooks.js'
import { ADDITIONAL_DEMO_CLIENT_IDS } from './demoCompanyBooks.js'

export const DEMO_RESET_CLIENTS = [
  { id: DEMO_CLIENT_ID, name: 'ABC Plumbing' },
  { id: ADDITIONAL_DEMO_CLIENT_IDS[0], name: 'Green Leaf Landscaping' },
  { id: ADDITIONAL_DEMO_CLIENT_IDS[1], name: 'Smith Construction' },
  { id: ADDITIONAL_DEMO_CLIENT_IDS[2], name: 'Johnson Dental' },
  { id: ADDITIONAL_DEMO_CLIENT_IDS[3], name: 'Acme Consulting' },
] as const
