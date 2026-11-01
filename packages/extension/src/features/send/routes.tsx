import type { RouteTable } from '../../popup/router';
import { SendFlow, type SendRoute } from './SendFlow';

export type { SendRoute } from './SendFlow';

export const sendRoutes: RouteTable<SendRoute> = { send: SendFlow };
