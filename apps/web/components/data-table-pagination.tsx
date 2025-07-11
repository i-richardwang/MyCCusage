"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { usePagination } from "@/hooks/use-pagination"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@workspace/ui/components/pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

interface DataTablePaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  onItemsPerPageChange: (itemsPerPage: number) => void
  paginationItemsToDisplay?: number
}

export function DataTablePagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  paginationItemsToDisplay = 5,
}: DataTablePaginationProps) {
  const { pages, showLeftEllipsis, showRightEllipsis } = usePagination({
    currentPage,
    totalPages,
    paginationItemsToDisplay,
  })

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      onPageChange(page)
    }
  }

  const handleItemsPerPageChange = (value: string) => {
    const newItemsPerPage = parseInt(value, 10)
    onItemsPerPageChange(newItemsPerPage)
  }

  // Don't render pagination if there's only one page or no items
  if (totalPages <= 1) {
    return null
  }

  return (
    <div className="flex items-center justify-between gap-3 py-4">
      {/* Page number information */}
      <p
        className="text-muted-foreground flex-1 text-sm whitespace-nowrap"
        aria-live="polite"
      >
        Showing{" "}
        <span className="text-foreground">
          {Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)}
        </span>{" "}
        to{" "}
        <span className="text-foreground">
          {Math.min(currentPage * itemsPerPage, totalItems)}
        </span>{" "}
        of <span className="text-foreground">{totalItems}</span> results
      </p>

      {/* Pagination */}
      <div className="grow">
        <Pagination>
          <PaginationContent>
            {/* Previous page button */}
            <PaginationItem>
              <PaginationLink
                className="cursor-pointer aria-disabled:pointer-events-none aria-disabled:opacity-50"
                onClick={() => handlePageChange(currentPage - 1)}
                aria-label="Go to previous page"
                aria-disabled={currentPage === 1 ? true : undefined}
              >
                <ChevronLeftIcon size={16} aria-hidden="true" />
              </PaginationLink>
            </PaginationItem>

            {/* First page if not in visible range */}
            {showLeftEllipsis && (
              <>
                <PaginationItem>
                  <PaginationLink
                    className="cursor-pointer"
                    onClick={() => handlePageChange(1)}
                  >
                    1
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
              </>
            )}

            {/* Page number links */}
            {pages.map((page) => (
              <PaginationItem key={page}>
                <PaginationLink
                  className="cursor-pointer"
                  onClick={() => handlePageChange(page)}
                  isActive={page === currentPage}
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}

            {/* Last page if not in visible range */}
            {showRightEllipsis && (
              <>
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink
                    className="cursor-pointer"
                    onClick={() => handlePageChange(totalPages)}
                  >
                    {totalPages}
                  </PaginationLink>
                </PaginationItem>
              </>
            )}

            {/* Next page button */}
            <PaginationItem>
              <PaginationLink
                className="cursor-pointer aria-disabled:pointer-events-none aria-disabled:opacity-50"
                onClick={() => handlePageChange(currentPage + 1)}
                aria-label="Go to next page"
                aria-disabled={currentPage === totalPages ? true : undefined}
              >
                <ChevronRightIcon size={16} aria-hidden="true" />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>

      {/* Results per page selector */}
      <div className="flex flex-1 justify-end">
        <Select
          value={itemsPerPage.toString()}
          onValueChange={handleItemsPerPageChange}
          aria-label="Results per page"
        >
          <SelectTrigger
            id="results-per-page"
            className="w-fit whitespace-nowrap"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5">5 / page</SelectItem>
            <SelectItem value="10">10 / page</SelectItem>
            <SelectItem value="20">20 / page</SelectItem>
            <SelectItem value="50">50 / page</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}