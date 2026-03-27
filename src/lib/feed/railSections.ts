interface RailSectionWithId {
  id: string
}

export function buildFeedRailSections<T extends RailSectionWithId>(options: {
  defaultSections: readonly T[]
  savedTagSections: readonly T[]
  routeSection: T | null
}): T[] {
  const { defaultSections, savedTagSections, routeSection } = options
  const [primarySection, ...otherSections] = defaultSections
  if (!primarySection) {
    return routeSection ? [routeSection, ...savedTagSections] : [...savedTagSections]
  }

  const tagSections = [...savedTagSections]

  if (routeSection && !tagSections.some((section) => section.id === routeSection.id)) {
    tagSections.unshift(routeSection)
  }

  return [primarySection, ...tagSections, ...otherSections]
}
