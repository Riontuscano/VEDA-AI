import { NextResponse } from "next/server";

import { AppError, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * 4xx returns the real message, because "page 3 is not a PNG" is actionable.
 * 5xx returns a generic one and logs the detail: internal errors aren't useful
 * on screen and can say more than they should.
 */
export function errorResponse(error: unknown, route: string): NextResponse {
  const appError: AppError = toAppError(error, "unknown");
  const isClientError = appError.httpStatus >= 400 && appError.httpStatus < 500;

  if (isClientError) {
    logger.info("Request rejected", {
      route,
      code: appError.code,
      message: appError.message,
    });
  } else {
    logger.error("Request failed", { route, err: appError });
  }

  return NextResponse.json(
    {
      error: {
        code: appError.code,
        message: isClientError
          ? appError.message
          : "Something went wrong on our side. Please try again.",
      },
    },
    { status: appError.httpStatus },
  );
}
