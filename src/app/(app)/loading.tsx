import { Skeleton } from "@/components/ui/primitives";

/**
 * Shared loading state for every page in the shell. Workflows run on request,
 * so the first paint of a page can take a moment — this keeps the layout stable
 * rather than flashing an empty screen.
 */
export default function Loading() {
  return (
    <div className="px-4 py-7 lg:px-8">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-96" />
      <Skeleton className="mt-6 h-20 w-full" />
      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
