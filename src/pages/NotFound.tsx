import { Link } from 'react-router-dom'
import { Card, EmptyState } from '../components/ui'

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        title="Page not found"
        description="That route does not exist in the dashboard."
        action={
          <Link to="/" className="btn btn-primary">
            Back to Overview
          </Link>
        }
      />
    </Card>
  )
}
