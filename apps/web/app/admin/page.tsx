'use client'

import { useList } from '@refinedev/core'
import { Card, Col, Row, Statistic } from 'antd'
import { at } from '../../lib/admin/t'

const useTotal = (resource: string, field: string, value: unknown) =>
  // pageSize 1: only `total` is needed
  useList({ resource, pagination: { currentPage: 1, pageSize: 1 }, filters: [{ field, operator: 'eq', value }] })

export default function Dashboard() {
  const pending = useTotal('documents', 'status', 'pending')
  const suspended = useTotal('users', 'suspended', true)
  return (
    <Row gutter={16}>
      <Col xs={24} md={8}>
        <Card>
          <Statistic title={at('admin.dashboard.pending')} value={pending.result?.total ?? 0} loading={pending.query.isLoading} />
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Statistic title={at('admin.dashboard.suspended')} value={suspended.result?.total ?? 0} loading={suspended.query.isLoading} />
        </Card>
      </Col>
    </Row>
  )
}
