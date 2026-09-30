import scenario from '../../scenarios/auction-deadline';
import { runScenario } from '../../support/pace';

runScenario(scenario, 'slow');
