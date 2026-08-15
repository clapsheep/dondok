import {
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleEllipsis,
  CreditCard,
  HandCoins,
  Landmark,
  PiggyBank,
  ShieldCheck,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { JointAvatar, MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { Label } from '../../components/ui/Label'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../../components/ui/Popover'
import { Switch } from '../../components/ui/Switch'
import type { LedgerMember } from '../membership/api'
import type { Asset, AssetTypeSystemCode } from './api'
import { assetPickerAmountLabel } from './assetPickerAmount'
import { buildAssetOverview, type AssetGroupKey } from './overview'
import { FinancialInstitutionAvatar } from './FinancialInstitutionPicker'
import { financialInstitution } from './financialInstitutions'

type MissingAssetSelection = {
  assetId: string
  name: string
  assetTypeName?: string
}

type Props = {
  id: string
  label: string
  assets: Asset[]
  members: LedgerMember[]
  value: string
  onChange: (assetId: string) => void
  placeholder?: string
  missingSelection?: MissingAssetSelection
  error?: string
  hint?: string
  disabled?: boolean
  required?: boolean
}

type PickerGroup = {
  key: AssetGroupKey
  label: string
  items: Asset[]
}

const assetIcons: Record<AssetTypeSystemCode, LucideIcon> = {
  CASH: Wallet,
  BANK: Landmark,
  CREDIT_CARD: CreditCard,
  DEBIT_CARD: CreditCard,
  SAVINGS: PiggyBank,
  INVESTMENT: ChartNoAxesCombined,
  LOAN: HandCoins,
  INSURANCE: ShieldCheck,
  OTHER: CircleEllipsis,
}

export function AssetPicker({
  id,
  label,
  assets,
  members,
  value,
  onChange,
  placeholder = '자산을 선택해 주세요',
  missingSelection,
  error,
  hint,
  disabled = false,
  required = false,
}: Props) {
  const generatedId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [showAllAssets, setShowAllAssets] = useState(false)
  const [activeGroup, setActiveGroup] = useState<AssetGroupKey | 'all'>('all')
  const selected = assets.find((asset) => asset.assetId === value)
  const missingSelected = !selected && value && missingSelection?.assetId === value ? missingSelection : undefined
  const currentMember = members.find((member) => member.currentUser)
  const ownAssets = currentMember
    ? assets.filter((asset) => asset.ownershipScope === 'PERSONAL' && asset.ownerMemberId === currentMember.memberId)
    : []
  const visibleAssets = showAllAssets ? assets : ownAssets
  const groups = pickerGroups(visibleAssets)
  const filteredGroups = activeGroup === 'all' ? groups : groups.filter((group) => group.key === activeGroup)
  const selectedOutsideOwnAssets = Boolean(selected && !ownAssets.some((asset) => asset.assetId === selected.assetId))
  const titleId = `${id}-${generatedId}-title`
  const descriptionId = `${id}-${generatedId}-description`
  const showAllAssetsId = `${id}-${generatedId}-show-all-assets`
  const selectionSummaryId = `${id}-${generatedId}-selection`
  const describedBy = [selectionSummaryId, hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ')
  const selectedLabel = selected ? `${selected.name}, ${selected.assetTypeName}, ${ownerLabel(selected, members)}, ${assetPickerAmountLabel(selected)}` : missingSelected ? `${missingSelected.name}, 현재 목록에 없음` : placeholder

  function selectAsset(assetId: string) {
    onChange(assetId)
    changeOpen(false)
  }

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setShowAllAssets(false)
      setActiveGroup('all')
    }
  }

  function changeAssetScope(checked: boolean) {
    setShowAllAssets(checked)
    setActiveGroup('all')
  }

  return (
    <div data-slot="field" data-asset-picker data-invalid={Boolean(error)} className="grid min-w-0 gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={changeOpen} modal>
        <PopoverTrigger
          render={(
            <Button
              ref={trigger}
              id={id}
              type="button"
              variant="secondary"
              className="h-auto min-h-12 w-full min-w-0 justify-start gap-2 px-2.5 py-1.5 text-left font-normal"
              data-value={value}
              aria-label={label}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              aria-required={required}
              disabled={disabled}
            />
          )}
        >
          {selected ? <AssetTriggerValue asset={selected} members={members} /> : missingSelected ? <MissingTriggerValue asset={missingSelected} /> : <span className="min-w-0 flex-1 text-[var(--muted)]">{placeholder}</span>}
          <ChevronDown className="ml-auto shrink-0 text-[var(--muted)]" size={18} aria-hidden="true" />
        </PopoverTrigger>

        <PopoverContent className="h-[min(52dvh,30rem)] md:h-auto" positionerClassName="asset-picker-positioner" aria-labelledby={titleId} aria-describedby={descriptionId} finalFocus={trigger}>
          <PopoverHeader className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start border-b border-[var(--line)] px-4 py-3 md:flex md:px-5 md:py-4">
            <div className="min-w-0">
              <PopoverTitle id={titleId}>{label} 선택</PopoverTitle>
              <PopoverDescription id={descriptionId} className="sr-only md:not-sr-only md:mt-1">처음에는 내 자산만 보여요. 필요하면 모든 자산 보기를 켜세요.</PopoverDescription>
            </div>
            <div className="col-span-2 row-start-2 mt-2 flex min-h-8 items-center justify-end gap-2 md:ml-auto md:mt-0 md:min-h-10">
              <Label htmlFor={showAllAssetsId} className="cursor-pointer whitespace-nowrap text-xs text-[var(--muted)]">모든 자산 보기</Label>
              <Switch
                id={showAllAssetsId}
                checked={showAllAssets}
                onCheckedChange={changeAssetScope}
                aria-label="모든 자산 보기"
              />
            </div>
            <PopoverClose
              render={<Button type="button" size="icon" variant="ghost" className="col-start-2 row-start-1 shrink-0 md:order-last" aria-label={`${label} 선택 닫기`} />}
            >
              <X size={19} />
            </PopoverClose>
          </PopoverHeader>

          {!showAllAssets && selectedOutsideOwnAssets ? (
            <button
              type="button"
              className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2 text-left text-xs text-[var(--muted)] transition-colors hover:bg-forest-50 hover:text-forest-800 dark:hover:bg-forest-950 dark:hover:text-forest-100"
              onClick={() => changeAssetScope(true)}
            >
              <span>현재 선택은 공동·다른 구성원 자산이에요.</span>
              <span className="shrink-0 font-semibold text-forest-700 dark:text-forest-100">목록에서 보기</span>
            </button>
          ) : null}

          {groups.length > 1 ? (
            <div className="flex shrink-0 gap-1 overflow-x-auto overscroll-x-contain border-b border-[var(--line)] px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] md:overflow-visible md:px-4 md:py-2" role="group" aria-label="자산 종류 필터">
              <GroupFilter label="전체" count={visibleAssets.length} active={activeGroup === 'all'} onSelect={() => setActiveGroup('all')} />
              {groups.map((group) => <GroupFilter key={group.key} label={group.label} count={group.items.length} active={activeGroup === group.key} onSelect={() => setActiveGroup(group.key)} />)}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-1.5 md:px-4 md:pb-4 md:pt-2">
            {missingSelected ? (
              <section aria-labelledby={`${id}-missing-group`}>
                <h3 id={`${id}-missing-group`} className="px-1 py-2 text-xs font-semibold text-[var(--muted)]">현재 연결</h3>
                <PopoverClose
                  render={<button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-2 border-y border-[var(--line)] px-2 py-2 text-left hover:bg-forest-50 dark:hover:bg-forest-950"
                    data-asset-option
                    data-asset-id={missingSelected.assetId}
                    aria-label={`${missingSelected.name}, 현재 목록에 없음`}
                    aria-pressed="true"
                  />}
                  onClick={() => selectAsset(missingSelected.assetId)}
                >
                  <span className="grid size-8 shrink-0 place-items-center bg-[var(--surface)] text-[var(--muted)]"><CircleEllipsis size={17} /></span>
                  <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{missingSelected.name}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{missingSelected.assetTypeName ?? '자산'} · 현재 목록에 없음</span></span>
                  <Check className="shrink-0 text-forest-700 dark:text-forest-100" size={17} aria-hidden="true" />
                </PopoverClose>
              </section>
            ) : null}

            {filteredGroups.length ? filteredGroups.map((group) => (
              <section className={missingSelected ? 'mt-3' : undefined} key={group.key} aria-labelledby={`${id}-${group.key}-group`}>
                <h3 id={`${id}-${group.key}-group`} className="flex items-center justify-between px-1 py-1.5 text-xs font-semibold text-[var(--muted)]"><span>{group.label}</span><span>{group.items.length}개</span></h3>
                <div className="grid border-t border-[var(--line)] md:grid-cols-2 md:border-l" role="group" aria-label={`${group.label} 자산`}>
                  {group.items.map((asset) => (
                    <AssetOption key={asset.assetId} asset={asset} members={members} active={asset.assetId === value} onSelect={selectAsset} />
                  ))}
                </div>
              </section>
            )) : <p className="px-2 py-8 text-center text-sm text-[var(--muted)]">{!showAllAssets && assets.length ? '선택할 수 있는 내 자산이 없어요. 모든 자산 보기를 켜서 공동·다른 구성원 자산을 확인해 주세요.' : '선택할 수 있는 자산이 없어요.'}</p>}
          </div>
        </PopoverContent>
      </Popover>
      <span id={selectionSummaryId} className="sr-only">현재 선택: {selectedLabel}</span>
      {hint ? <p id={`${id}-hint`} data-slot="field-description" className="text-xs text-[var(--muted)]">{hint}</p> : null}
      {error ? <p id={`${id}-error`} data-slot="field-error" className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}

function AssetTriggerValue({ asset, members }: { asset: Asset; members: LedgerMember[] }) {
  const Icon = assetIcons[asset.systemCode]
  const owner = resolveOwner(asset, members)
  const bankRelated = asset.systemCode === 'BANK' || asset.systemCode === 'SAVINGS'
  return (
    <>
      {bankRelated ? <FinancialInstitutionAvatar code={asset.financialInstitutionCode} /> : <span className="grid size-7 shrink-0 place-items-center bg-forest-50 text-forest-700 dark:bg-forest-950 dark:text-forest-100"><Icon size={16} aria-hidden="true" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-4" title={asset.name}>{asset.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-4 text-[var(--muted)]"><OwnerAvatar owner={owner} /><span className="min-w-0 truncate">{bankRelated ? `${financialInstitution(asset.financialInstitutionCode).name} · ` : ''}{asset.assetTypeName} · {owner.label}</span></span>
      </span>
      <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--muted)] max-[22rem]:hidden">{assetPickerAmountLabel(asset)}</span>
    </>
  )
}

function MissingTriggerValue({ asset }: { asset: MissingAssetSelection }) {
  return <><span className="grid size-8 shrink-0 place-items-center bg-[var(--surface)] text-[var(--muted)]"><CircleEllipsis size={17} /></span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{asset.name}</span><span className="text-xs text-[var(--muted)]">현재 목록에 없음</span></span></>
}

function AssetOption({ asset, members, active, onSelect }: { asset: Asset; members: LedgerMember[]; active: boolean; onSelect: (assetId: string) => void }) {
  const Icon = assetIcons[asset.systemCode]
  const owner = resolveOwner(asset, members)
  const bankRelated = asset.systemCode === 'BANK' || asset.systemCode === 'SAVINGS'
  const accessibleName = `${asset.name}, ${asset.assetTypeName}, ${owner.label}, ${assetPickerAmountLabel(asset)}`
  return (
    <PopoverClose
      render={<button
        type="button"
        className={`grid min-h-14 min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--line)] px-2 py-1.5 text-left transition-colors hover:bg-forest-50 dark:hover:bg-forest-950 md:border-r ${active ? 'bg-forest-50 text-forest-800 dark:bg-forest-950 dark:text-forest-100' : 'bg-[var(--surface)]'}`}
        data-asset-option
        data-asset-id={asset.assetId}
        data-asset-system-code={asset.systemCode}
        aria-label={accessibleName}
        aria-pressed={active}
      />}
      onClick={() => onSelect(asset.assetId)}
    >
      {bankRelated ? <FinancialInstitutionAvatar code={asset.financialInstitutionCode} /> : <span className="grid size-7 place-items-center bg-forest-50 text-forest-700 dark:bg-forest-950 dark:text-forest-100"><Icon size={16} aria-hidden="true" /></span>}
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2 leading-4"><span className="min-w-0 flex-1 truncate text-sm font-semibold" title={asset.name}>{asset.name}</span><span className="shrink-0 text-[0.6875rem] font-semibold tabular-nums text-[var(--muted)]">{assetPickerAmountLabel(asset)}</span></span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-4 text-[var(--muted)]"><OwnerAvatar owner={owner} /><span className="min-w-0 truncate">{bankRelated ? `${financialInstitution(asset.financialInstitutionCode).name} · ` : ''}{asset.assetTypeName} · {owner.label}</span></span>
      </span>
      {active ? <Check className="mt-0.5 shrink-0 text-forest-700 dark:text-forest-100" size={17} aria-hidden="true" /> : null}
    </PopoverClose>
  )
}

function GroupFilter({ label, count, active, onSelect }: { label: string; count: number; active: boolean; onSelect: () => void }) {
  return <Button type="button" variant="ghost" className={`min-h-11 shrink-0 gap-1 rounded-none px-2.5 text-xs md:min-w-0 md:px-2 ${active ? 'bg-forest-100 text-forest-800 dark:bg-forest-800 dark:text-white' : 'text-[var(--muted)]'}`} aria-pressed={active} onClick={onSelect}><span>{label}</span><span className="tabular-nums opacity-70">{count}</span></Button>
}

function pickerGroups(assets: Asset[]): PickerGroup[] {
  const groups = buildAssetOverview(assets).groups.map((group) => ({ key: group.key, label: group.label, items: group.items }))
  if (groups.length === 1 && assets.every((asset) => asset.systemCode === 'BANK')) groups[0].label = '계좌'
  if (groups.length === 1 && assets.some((asset) => asset.systemCode === 'SAVINGS') && assets.every((asset) => asset.systemCode === 'BANK' || asset.systemCode === 'SAVINGS')) groups[0].label = '계좌·적금'
  if (groups.length === 1 && assets.every((asset) => asset.systemCode === 'CREDIT_CARD')) groups[0].label = '신용카드'
  return groups
}

function ownerLabel(asset: Asset, members: LedgerMember[]) {
  return resolveOwner(asset, members).label
}

type ResolvedOwner = { label: string; member?: LedgerMember; joint: boolean }

function resolveOwner(asset: Asset, members: LedgerMember[]): ResolvedOwner {
  if (asset.ownershipScope === 'JOINT') return { label: '공동', joint: true }
  const member = members.find((item) => item.memberId === asset.ownerMemberId)
  if (!member) return { label: '구성원', joint: false }
  return { label: member.currentUser ? '나' : member.displayName, member, joint: false }
}

function OwnerAvatar({ owner }: { owner: ResolvedOwner }) {
  if (owner.joint) return <JointAvatar size="xs" />
  if (!owner.member) return null
  return <MemberAvatar displayName={owner.member.displayName} memberId={owner.member.memberId} size="xs" />
}
