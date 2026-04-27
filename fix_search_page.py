import sys

with open('src/pages/SearchPage.tsx', 'r') as f:
    lines = f.readlines()

new_lines = lines[:491] # Keep everything up to just before first SearchHint

# Re-insert the corrected functions
new_lines.append('function SearchSynthesisCard({\n')
new_lines.append('  text,\n')
new_lines.append('  source,\n')
new_lines.append('  loading,\n')
new_lines.append('}: {\n')
new_lines.append('  text: string | null\n')
new_lines.append('  source: "gemma" | "gemini" | null\n')
new_lines.append('  loading: boolean\n')
new_lines.append('}) {\n')
new_lines.append('  return (\n')
new_lines.append('    <motion.div\n')
new_lines.append('      initial={{ opacity: 0, y: 8 }}\n')
new_lines.append('      animate={{ opacity: 1, y: 0 }}\n')
new_lines.append('      transition={{ duration: 0.2 }}\n')
new_lines.append('      className="rounded-ios-xl p-4 app-panel card-elevated"\n')
new_lines.append('    >\n')
new_lines.append('      <div className="flex items-center gap-2 mb-2">\n')
new_lines.append('        <span className="section-kicker">AI Summary</span>\n')
new_lines.append('        {source && (\n')
new_lines.append('          <span className="text-[11px] text-[rgb(var(--color-label-tertiary))]">\n')
new_lines.append('            via {source}\n')
new_lines.append('          </span>\n')
new_lines.append('        )}\n')
new_lines.append('      </div>\n')
new_lines.append('      {loading && !text ? (\n')
new_lines.append('        <div className="flex items-center gap-2">\n')
new_lines.append('          <span className="block h-2 w-2 rounded-full bg-[rgb(var(--color-accent))] animate-pulse" />\n')
new_lines.append('          <span className="text-[14px] text-[rgb(var(--color-label-secondary))]">\n')
new_lines.append('            Summarizing results…\n')
new_lines.append('          </span>\n')
new_lines.append('        </div>\n')
new_lines.append('      ) : (\n')
new_lines.append('        <p className="text-[14px] leading-relaxed text-[rgb(var(--color-label))]">\n')
new_lines.append('          {text}\n')
new_lines.append('        </p>\n')
new_lines.append('      )}\n')
new_lines.append('    </motion.div>\n')
new_lines.append('  )\n')
new_lines.append('}\n\n')
new_lines.append('function SearchHint() {\n')

# Append the rest from the second SearchHint onwards
new_lines.extend(lines[533:])

with open('src/pages/SearchPage.tsx', 'w') as f:
    f.writelines(new_lines)
