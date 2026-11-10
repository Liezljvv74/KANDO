import type { HelpTopic } from '@kando/contract'

import { groupTopics, toggleOpen } from './help'

const topic = (slug: string, group: HelpTopic['group'], sort: number): HelpTopic => ({ slug, group, sort, title: slug, body: `${slug} body` })

test('the opening topic stands alone; the others are grouped in the fixed heading order and sorted inside a group', () => {
  const { opening, groups } = groupTopics([
    topic('paying', 'booking-and-paying', 70),
    topic('what-is-kando', 'using-the-app', 10),
    topic('your-data-a', 'your-data', 270),
    topic('quotes', 'using-the-app', 60),
    topic('finding', 'using-the-app', 40),
    topic('cancelling', 'booking-and-paying', 100),
  ])
  expect(opening?.slug).toBe('what-is-kando')
  expect(groups.map((g) => g.group)).toEqual(['using-the-app', 'booking-and-paying', 'your-data'])
  expect(groups[0]!.topics.map((t) => t.slug)).toEqual(['finding', 'quotes'])
  expect(groups[1]!.topics.map((t) => t.slug)).toEqual(['paying', 'cancelling'])
})

test('without an opening topic (or with no topics) nothing breaks', () => {
  expect(groupTopics([topic('quotes', 'using-the-app', 60)])).toEqual({ opening: null, groups: [{ group: 'using-the-app', topics: [topic('quotes', 'using-the-app', 60)] }] })
  expect(groupTopics([])).toEqual({ opening: null, groups: [] })
})

test('toggleOpen opens and closes a topic and leaves the others alone, without changing its input', () => {
  const none = new Set<string>()
  const one = toggleOpen(none, 'a')
  expect([...one]).toEqual(['a'])
  expect(none.size).toBe(0)
  expect([...toggleOpen(one, 'b')]).toEqual(['a', 'b'])
  expect([...toggleOpen(one, 'a')]).toEqual([])
})
