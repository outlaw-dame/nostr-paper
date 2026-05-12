import type { ReportPublishDestination } from '@/lib/moderation/reportingSettings'

export function getProfileReportPublishedMessage(details: { destination: ReportPublishDestination; mutedAuthor: boolean }): string {
  const destinationMessage = details.destination === 'private'
    ? 'Private report published to your configured relay list.'
    : details.destination === 'moderator'
      ? 'Encrypted moderation request sent to the configured moderator service.'
      : 'Kind-1984 report published to your write relays.'
  const mutedMessage = details.mutedAuthor ? ' Author muted locally.' : ''
  return `${destinationMessage}${mutedMessage}`
}
