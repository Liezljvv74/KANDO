import { AddressFields } from '@/components/address-fields'
import { Field } from '@/components/auth-ui'
import { DateTimeField } from '@/components/date-time-field'
import { SwitchRow } from '@/components/form-ui'
import { t } from '@/i18n'
import { withDay, withTimeOfDay, type WhenWhere } from '@/lib/when-where'

/**
 * The ONE set of "when and where" fields: date and time (native pickers), duration, on site or remote, the address and a note.
 * It serves the request form, a counter and an entered time; `buildProposal` (lib/when-where.ts) turns the value into what the
 * server takes. `withDetails`: also ask for the address and the note. `canRemote`: the person may choose remote.
 */
export function WhenWhereFields({
  value,
  onChange,
  canRemote,
  withDetails,
  disabled,
}: {
  value: WhenWhere
  onChange: (v: WhenWhere) => void
  canRemote: boolean
  withDetails: boolean
  disabled?: boolean
}) {
  const wantsSite = !canRemote || value.onSite
  return (
    <>
      <DateTimeField label={t('booking.whenDate')} placeholder={t('booking.pickDate')} mode="date" value={value.when} minimumDate={new Date()} onChange={(d) => onChange({ ...value, when: withDay(value.when, d) })} disabled={disabled} />
      <DateTimeField label={t('booking.whenTime')} placeholder={t('booking.pickTime')} mode="time" value={value.when} onChange={(d) => onChange({ ...value, when: withTimeOfDay(value.when, d) })} disabled={disabled} />
      <Field label={t('booking.durationField')} value={value.duration} onChangeText={(duration) => onChange({ ...value, duration })} keyboardType="number-pad" editable={!disabled} />
      {canRemote && <SwitchRow label={t('booking.onSite')} value={value.onSite} onChange={(onSite) => onChange({ ...value, onSite })} />}
      {withDetails && wantsSite && <AddressFields value={value.address} onChange={(address) => onChange({ ...value, address })} disabled={disabled} />}
      {withDetails && <Field label={t('booking.noteField')} value={value.note} onChangeText={(note) => onChange({ ...value, note })} multiline editable={!disabled} />}
    </>
  )
}
