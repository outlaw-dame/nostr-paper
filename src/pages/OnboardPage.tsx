// OnboardPage — Phase 2
import { Page, Navbar, Block, Button } from 'konsta/react'
import { useNavigate } from 'react-router-dom'

export default function OnboardPage() {
  const navigate = useNavigate()
  return (
    <Page>
      <Navbar title="Welcome to Paper" />
      <Block>
        <p className="text-body text-[rgb(var(--color-label-secondary))] mb-4">
          Connect your Nostr identity to get started.
          Full onboarding coming in Phase 2.
        </p>
        <Button onClick={() => navigate('/')}>Browse without account</Button>
      </Block>
    </Page>
  )
}
