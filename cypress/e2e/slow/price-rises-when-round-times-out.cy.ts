import scenario from '../../scenarios/price-rises-when-round-times-out';
import { runScenario } from '../../support/pace';

runScenario(scenario, 'slow');
