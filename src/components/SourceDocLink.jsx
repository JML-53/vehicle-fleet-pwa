/**
 * SourceDocLink — "📄 Source document" link to the document a record was
 * created from (item 9.5). Renders nothing when there is no document.
 */
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'

export default function SourceDocLink({ documentId, label = 'Source document', className = '' }) {
  if (!documentId) return null
  return (
    <Link to={`/documents/${documentId}`} onClick={e => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 underline decoration-primary-200 ${className}`}>
      <FileText size={11} /> {label}
    </Link>
  )
}
