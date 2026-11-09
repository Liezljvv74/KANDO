import { StyleSheet, Text, View } from 'react-native'

import { getLang, useLang } from '@/i18n'
import { headerCells, type HeaderJob } from '@/lib/job-header'
import { color } from '@/theme'

/**
 * The job page's top block (spec 4.3): two columns, three lines, one font (12, semi-bold, one colour), a colon after each label.
 * Each cell is one line, cut with "…" when a value is too long (a long name), never wrapped.
 */
export function JobHeader({ job, viewer }: { job: HeaderJob; viewer: 'customer' | 'provider' }) {
  useLang()
  const cells = headerCells(job, viewer, getLang())
  return (
    <View style={styles.grid}>
      {cells.map((c) => (
        <Text key={c.label} style={styles.cell} numberOfLines={1} ellipsizeMode="tail">
          {`${c.label}: ${c.value}`}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6, columnGap: 12 },
  // two per line: each takes just under half, the column gap takes the rest
  cell: { width: '47%', flexGrow: 1, fontSize: 12, fontWeight: '600', color: color.ink },
})
