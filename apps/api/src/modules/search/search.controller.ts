import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiGatewayTimeoutResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { seconds, Throttle } from '@nestjs/throttler';
import { type SearchResult, searchResultSchema } from '@vozzify/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import { SearchService } from './search.service.js';
import { SearchQueryDto } from './search-query.dto.js';

class SearchResultDto extends createZodDto(searchResultSchema) {}

@ApiTags('search')
@Public()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  // Unauthenticated on purpose: visitors search before they sign up. Abuse
  // is bounded by a stricter per-IP limit than the global one (realtime
  // typing stays usable while sustained floods answer 429 `RATE_LIMITED`).
  // A down catalog answers 503 `SERVICE_UNAVAILABLE` and a slow one 504
  // `GATEWAY_TIMEOUT`, so the web retries instead of showing a dead end.
  @Get()
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  @ZodSerializerDto(searchResultSchema)
  @ApiOkResponse({
    description: 'Catalog matches, best first.',
    type: SearchResultDto,
  })
  @ApiBadRequestResponse({ description: 'The query or paging is bad.' })
  @ApiTooManyRequestsResponse({ description: 'Per-IP search rate exceeded.' })
  @ApiServiceUnavailableResponse({ description: 'The Music catalog is down.' })
  @ApiGatewayTimeoutResponse({
    description: 'The Music catalog took too long.',
  })
  search(@Query() query: SearchQueryDto): Promise<SearchResult> {
    return this.searchService.search(query);
  }
}
