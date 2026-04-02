import { createFileRoute } from '@tanstack/react-router'
import { ManifestAuditor } from '@/components/apps/ManifestAuditor'

export const Route = createFileRoute('/settings/security')({
  component: () => <ManifestAuditor />,
})
