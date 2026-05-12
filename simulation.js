import { NeuralNet } from './nn.js';
import { NN_TOPOLOGY } from './constants.js';
import { Car } from './car.js';

// Manages a population of cars and runs the genetic algorithm
export class Simulation {
  constructor(track, popSize = 50, mutRate = 0.15) {
    this.track = track;
    this.popSize = popSize;
    this.mutRate = mutRate;
    this.mutStrength = 0.5;
    this.generation = 0;
    this.bestFitnessAll = 0;
    this.bestBrain = null;
    this.fitnessHistory = [];
    this.genLog = [];
    this.maxTicks = 2000;
    this.tick = 0;
    this.spawn();
  }

  // Create a fresh batch of cars. First gen = random brains.
  // Later gens = clones of the best brain, mutated.
  spawn() {
    this.cars = [];
    this.tick = 0;
    for (let i = 0; i < this.popSize; i++) {
      const brain = (i === 0 && this.bestBrain)
        ? this.bestBrain.clone()
        : (this.bestBrain ? this.bestBrain.clone() : new NeuralNet(NN_TOPOLOGY));
      if (i > 0) brain.mutate(this.mutRate, this.mutStrength);
      this.cars.push(new Car(this.track, brain));
    }
  }

  // Advance simulation by one tick. End generation if all dead or timeout.
  step() {
    this.tick++;
    let anyAlive = false;
    for (const c of this.cars) {
      if (c.alive) { c.update(); anyAlive = true; }
    }
    if (!anyAlive || this.tick >= this.maxTicks) {
      this.evolve();
    }
  }

  // End of generation: pick the best, breed, mutate, spawn next gen
  evolve() {
    this.cars.sort((a, b) => b.fitness - a.fitness);
    const bestFit = this.cars[0].fitness;

    if (bestFit > this.bestFitnessAll) {
      this.bestFitnessAll = bestFit;
      this.bestBrain = this.cars[0].brain.clone();
    }
    this.fitnessHistory.push(bestFit);

    const bestCar = this.cars[0];
    const numCP = this.track.checkpoints.length;
    this.genLog.push({
      gen: this.generation,
      fitness: bestFit,
      ticks: bestCar.ticks,
      dist: Math.round((bestFit / numCP) * 100),
    });

    // Selection: top 10% elite, top 35% breeding pool
    const eliteCount = Math.max(2, Math.floor(this.popSize * 0.1));
    const pool = this.cars.slice(0, Math.floor(this.popSize * 0.35));

    const newBrains = [];
    for (let i = 0; i < eliteCount; i++) {
      newBrains.push(this.cars[i].brain.clone());
    }
    newBrains.push(this.bestBrain.clone());

    while (newBrains.length < this.popSize) {
      const pA = pool[Math.floor(Math.random() * pool.length)].brain;
      const pB = pool[Math.floor(Math.random() * pool.length)].brain;
      const child = NeuralNet.crossover(pA, pB);
      child.mutate(this.mutRate, this.mutStrength);
      newBrains.push(child);
    }

    this.generation++;
    this.cars = [];
    this.tick = 0;
    for (const brain of newBrains) {
      this.cars.push(new Car(this.track, brain));
    }
  }

  aliveCount() { return this.cars.filter(c => c.alive).length; }

  bestCar() {
    let best = null;
    for (const c of this.cars) {
      if (c.alive && (!best || c.fitness > best.fitness)) best = c;
    }
    return best || this.cars[0];
  }

  currentBestFitness() {
    return Math.max(...this.cars.map(c => c.fitness));
  }
}
