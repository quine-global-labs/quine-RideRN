import scenario from '../../scenarios/ride-queue-limit';
import { runScenario } from '../../support/pace';

runScenario(scenario, 'slow');
