import { NextResponse } from "next/server";

import { AppError, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Turns any thrown value into a JSON error response.
 *
 * Client-caused failures (4xx) return their real message, because the user can
 * act on "page 3 is not a PNG or JPEG". Server-side failures return a generic
 * message and log the detail — an internal error message is not a useful thing
 * to put on a user's screen, and may say more than it should.
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
