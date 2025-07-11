/**
 * Hook for calculating pagination display logic
 */
export interface UsePaginationProps {
  currentPage: number
  totalPages: number
  paginationItemsToDisplay?: number
}

export interface UsePaginationReturn {
  pages: number[]
  showLeftEllipsis: boolean
  showRightEllipsis: boolean
}

export function usePagination({
  currentPage,
  totalPages,
  paginationItemsToDisplay = 5,
}: UsePaginationProps): UsePaginationReturn {
  if (totalPages <= paginationItemsToDisplay) {
    // If total pages is less than or equal to display items, show all pages
    return {
      pages: Array.from({ length: totalPages }, (_, i) => i + 1),
      showLeftEllipsis: false,
      showRightEllipsis: false,
    }
  }

  const halfDisplay = Math.floor(paginationItemsToDisplay / 2)
  let startPage = Math.max(1, currentPage - halfDisplay)
  let endPage = Math.min(totalPages, currentPage + halfDisplay)

  // Adjust if we're near the beginning
  if (currentPage <= halfDisplay + 1) {
    startPage = 1
    endPage = paginationItemsToDisplay
  }

  // Adjust if we're near the end
  if (currentPage >= totalPages - halfDisplay) {
    startPage = totalPages - paginationItemsToDisplay + 1
    endPage = totalPages
  }

  const pages = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i
  )

  const showLeftEllipsis = startPage > 2
  const showRightEllipsis = endPage < totalPages - 1

  return {
    pages,
    showLeftEllipsis,
    showRightEllipsis,
  }
}