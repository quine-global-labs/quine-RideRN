import scenario from '../../scenarios/surge-pricing';
import { runScenario } from '../../support/pace';

runScenario(scenario, 'slow');
