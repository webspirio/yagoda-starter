import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IntakesService } from './intakes.service';
import { CreateIntakeDto } from './dto/create-intake.dto';
import { PreviewIntakeDto } from './dto/preview-intake.dto';
import { VoidDocumentDto } from './dto/void-document.dto';
import { ListIntakesQueryDto } from './dto/list-intakes.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * The berry receipt. ONE POST WRITES THE WHOLE DOCUMENT — items and their tare
 * lines nested, in one transaction (§2.3, «один візит із кількома сортами це
 * ОДИН документ»). `intake_items` and `intake_item_tare_types` have no routes
 * of their own: they are parts of a document, not rows in their own right.
 *
 * NO `PATCH`. §2.7 — `amount` «після проведення не міняється НІКОЛИ», and §9.3
 * makes a correction a void plus a NEW document: «Часткового сторно немає.
 * Тільки повне + новий правильний документ».
 *
 * NO `DELETE`, here or anywhere. §9.3 — «фізичного видалення проведеного
 * документа немає ні в кого, включно з керівником», and §10.4 lists it under
 * «Ніхто, ніколи».
 *
 * VOIDING AUTHORITY IS DECIDED IN THE SERVICE, not by a guard, because it
 * depends on the ROW: §9.4 gives an operator their own same-day receipt and
 * «чужа квитанція → приймальник НІКОЛИ». A guard answers "may this role call
 * this operation" from the request alone and cannot see who recorded the
 * document.
 */
@Controller('intakes')
export class IntakesController {
  constructor(private readonly intakes: IntakesService) {}

  @Post()
  @Auth()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateIntakeDto) {
    return this.intakes.create(actor, dto);
  }

  /**
   * DECLARED BEFORE EVERY `:id` ROUTE. Nest matches in declaration order, and
   * a `@Post(':id')` added below later would otherwise swallow `/preview` as
   * an id and 400 from `ParseUUIDPipe` — the discipline `GradePricesController`
   * keeps for `/current`. Today's `:id` routes are a `GET` and a three-segment
   * `POST`, so nothing collides yet; the ordering is kept so that adding one
   * cannot break this silently.
   *
   * 200, NOT 201: a computed answer with nothing created. This is `create` up
   * to the point where it would write, and then nothing — §2.4/§2.8/§2.9 make
   * the server the only place these numbers are computed, so the reception
   * screen asks for them live instead of computing its own. Same body as
   * `POST /intakes` minus `code`; the same refusals, `NO_OPEN_SHIFT` included,
   * so the operator learns the form is unusable BEFORE typing a whole receipt
   * into it.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Auth()
  preview(@CurrentUser() actor: AuthenticatedUser, @Body() dto: PreviewIntakeDto) {
    return this.intakes.preview(actor, dto);
  }

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListIntakesQueryDto) {
    return this.intakes.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.intakes.findOne(actor, id);
  }

  @Post(':id/void')
  @Auth()
  void(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.intakes.void(actor, id, dto);
  }
}
