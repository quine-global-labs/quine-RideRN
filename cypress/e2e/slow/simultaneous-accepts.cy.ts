import scenario from '../../scenarios/simultaneous-accepts';
import { runScenario } from '../../support/pace';

runScenario(scenario, 'slow');
