/** The job's title everywhere: the provider's own service title, else the category name. */
export const jobTitle = (serviceTitle: string | null | undefined, categoryName: string): string => serviceTitle?.trim() || categoryName

/** `#1040` for the job itself (position 1), `#1040-2` for its first additional task: worked out when shown, never stored. */
export const taskNumber = (jobNumber: number, position: number): string => (position <= 1 ? `#${jobNumber}` : `#${jobNumber}-${position}`)
