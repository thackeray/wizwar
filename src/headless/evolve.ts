// Run the self-evolving AI evolution process.

import { GeneticEvolver } from '../core/ai/evolving';

async function main() {
  const generations = parseInt(process.argv[2] ?? '10', 10);
  const populationSize = parseInt(process.argv[3] ?? '20', 10);
  
  console.log(`Starting evolution with ${generations} generations, population ${populationSize}...`);
  
  const evolver = new GeneticEvolver(populationSize);
  
  for (let gen = 0; gen < generations; gen++) {
    console.log(`\n=== Generation ${gen + 1} ===`);
    await evolver.runGeneration(3); // 3 matches per bot
    
    const stats = evolver.getStats();
    console.log(`Avg fitness: ${stats.avgFitness.toFixed(2)}`);
    console.log(`Best fitness: ${stats.bestFitness}`);
    console.log(`Best params:`, JSON.stringify(stats.bestParams, null, 2));
  }
  
  // Save the best bot's parameters.
  const best = evolver.getBestBot();
  console.log('\n=== Final Best Bot ===');
  console.log(`Name: ${best.name}`);
  console.log(`Wins: ${best.wins}, Losses: ${best.losses}`);
  console.log(`Params:`, JSON.stringify(best.params, null, 2));
  
  // Save to file.
  const fs = await import('fs');
  fs.writeFileSync('evolved-params.json', JSON.stringify(best.params, null, 2));
  console.log('\nSaved to evolved-params.json');
}

main().catch(console.error);