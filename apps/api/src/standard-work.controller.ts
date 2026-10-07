import {
  Body,
  Delete,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import {
  WorkPrice,
  StandardWork,
  StandardWorkRequest,
  WorkCompositeRequest,
} from "@jongno/shared";
import { StandardWorkService } from "./standard-work.service";
@Controller("standard-work")
export class StandardWorkController {
  constructor(
    @Inject(StandardWorkService) private readonly service: StandardWorkService,
  ) {}
  @Get() list() {
    return this.service.list();
  }
  @Post("initialize-defaults") initialize() {
    return this.service.initializeDefaults();
  }
  @Post("composite") composite(@Body() body: WorkCompositeRequest) {
    return this.service.composite(body);
  }
  @Post() create(@Body() body: StandardWork) {
    return this.service.create(body);
  }
  @Post(":id/copy") copy(@Param("id") id: string) {
    return this.service.copy(id);
  }
  @Delete(":id") archive(@Param("id") id: string) {
    return this.service.archive(id);
  }
  @Post("prices") createPrice(@Body() body: WorkPrice) {
    return this.service.savePrice(body);
  }
  @Put("prices/:id") price(@Param("id") id: string, @Body() body: WorkPrice) {
    return this.service.savePrice(body, id);
  }
  @Get("favorites") favorites() {
    return this.service.favorites();
  }
  @Put("favorites") saveFavorites(@Body() body: { priceIds: unknown }) {
    return this.service.saveFavorites(body);
  }
  @Get(":id/history") history(@Param("id") id: string) {
    return this.service.history(id);
  }
  @Put(":id") save(@Param("id") id: string, @Body() body: StandardWork) {
    return this.service.save(id, body);
  }
  @Post(":id/calculate") calculate(
    @Param("id") id: string,
    @Body() body: StandardWorkRequest,
  ) {
    return this.service.calculate(id, body);
  }
}
