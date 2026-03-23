import { renderToStaticMarkup } from 'react-dom/server'
import { ActionButton } from './ActionButton'

describe('ActionButton', () => {
  it('renders with default button type and nearby class', () => {
    const html = renderToStaticMarkup(
      <ActionButton className="btn">Click me</ActionButton>
    )

    expect(html).toContain('type="button"')
    expect(html).toContain('class="btn"')
    expect(html).toContain('Click me')
  })

  it('uses explicit type when provided', () => {
    const html = renderToStaticMarkup(
      <ActionButton type="submit">Submit</ActionButton>
    )

    expect(html).toContain('type="submit"')
    expect(html).toContain('Submit')
  })
})
