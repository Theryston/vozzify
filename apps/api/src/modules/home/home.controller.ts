import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type HomeFeed,
  homeFeedSchema,
  homeRowItemsPageSchema,
} from '@vozzify/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { HomeService } from './home.service.js';
import { HomeFeedQueryDto } from './home-feed-query.dto.js';
import { HomeRowItemsService } from './home-row-items.service.js';
import { HomeRowItemsQueryDto } from './home-row-items-query.dto.js';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(
    private readonly home: HomeService,
    private readonly rowItems: HomeRowItemsService,
  ) {}

  // Public: a signed-in visitor gets the same route, with the pins for Users.
  // Its response is private, since it differs from the anonymous one. A cursor
  // names the feed version it was issued for; the fallback home, served while
  // another request builds the feed, is never stored.
  @Public()
  @Get()
  @ZodSerializerDto(homeFeedSchema)
  @ApiOkResponse({
    description: 'One page of the home feed (at most six rows).',
  })
  @ApiBadRequestResponse({ description: 'The cursor is malformed.' })
  @ApiNotFoundResponse({
    description:
      'The cursor names a feed version that is no longer served (`NOT_FOUND`, `details.reason` = `FEED_VERSION_EXPIRED`): start again from the first page.',
  })
  async getHome(
    @Query() query: HomeFeedQueryDto,
    @CurrentUser() user: AuthUser | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<HomeFeed> {
    const { page, cacheControl } = await this.home.getPage(
      query.cursor,
      query.locale,
      user?.id,
    );
    response.setHeader('Cache-Control', cacheControl);
    return page;
  }

  @Public()
  @Get('rows/:rowId/items')
  @ZodSerializerDto(homeRowItemsPageSchema)
  @ApiOkResponse({ description: 'One page of a frozen Home Track Row.' })
  @ApiBadRequestResponse({ description: 'The item cursor is malformed.' })
  @ApiNotFoundResponse({ description: 'The visit or Row has expired.' })
  async getRowItems(
    @Param('rowId') rowId: string,
    @Query() query: HomeRowItemsQueryDto,
    @CurrentUser() user: AuthUser | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.rowItems.getPage(rowId, query.cursor, user?.id);
    response.setHeader('Cache-Control', result.cacheControl);
    return result.page;
  }
}
