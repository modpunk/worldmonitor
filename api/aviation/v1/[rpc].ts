/**
 * Aviation gRPC Gateway Edge Function
 * Handles aviation domain RPC calls via edge-compatible gateway
 */

import type { NextRequest } from "next/server";

export const runtime = "edge";

// grpc service definitions for aviation domain
const AVIATION_SERVICES = {
  GetFlightStatus: "aviation.v1.FlightService/GetFlightStatus",
  ListFlights: "aviation.v1.FlightService/ListFlights",
  GetAirportInfo: "aviation.v1.AirportService/GetAirportInfo",
  GetAirspaceStatus: "aviation.v1.AirspaceService/GetAirspaceStatus",
  StreamFlightUpdates: "aviation.v1.FlightService/StreamFlightUpdates",
} as const;

type AviationRpc = keyof typeof AVIATION_SERVICES;

const GRPC_GATEWAY_URL = process.env.GRPC_GATEWAY_URL || "http://localhost:8080";

interface GrpcGatewayResponse {
  data?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

async function forwardToGrpcGateway(
  servicePath: string,
  body: unknown,
  headers: Headers
): Promise<GrpcGatewayResponse> {
  const url = `${GRPC_GATEWAY_URL}/${servicePath}`;

  const grpcHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const authHeader = headers.get("authorization");
  if (authHeader) {
    grpcHeaders["authorization"] = authHeader;
  }

  const traceHeader = headers.get("x-request-id");
  if (traceHeader) {
    grpcHeaders["x-request-id"] = traceHeader;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: grpcHeaders,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: {
          code: response.status,
          message: data?.message || "grpc gateway error",
        },
      };
    }

    return { data };
  } catch (err) {
    return {
      error: {
        code: 503,
        message: `grpc gateway unreachable: ${(err as Error).message}`,
      },
    };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { rpc: string } }
) {
  const rpcName = params.rpc as AviationRpc;

  const servicePath = AVIATION_SERVICES[rpcName];
  if (!servicePath) {
    return new Response(
      JSON.stringify({
        error: {
          code: 404,
          message: `Unknown aviation edge rpc: ${rpcName}`,
        },
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body is acceptable for some RPCs
  }

  const result = await forwardToGrpcGateway(
    servicePath,
    body,
    request.headers
  );

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.error.code,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result.data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { rpc: string } }
) {
  const rpcName = params.rpc as AviationRpc;

  const servicePath = AVIATION_SERVICES[rpcName];
  if (!servicePath) {
    return new Response(
      JSON.stringify({
        error: {
          code: 404,
          message: `Unknown aviation edge rpc: ${rpcName}`,
        },
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(request.url);
  const body = Object.fromEntries(url.searchParams.entries());

  const result = await forwardToGrpcGateway(
    servicePath,
    body,
    request.headers
  );

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.error.code,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result.data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
